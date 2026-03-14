
import React, { useState, useCallback, useEffect } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAgentProfiles } from './hooks/useAgentProfiles';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { RecordingService } from './components/RecordingsPanel';
import { EmbedCodeModal } from './components/EmbedCodeModal';
import { SettingsModal } from './components/SettingsModal';
import { AgentWidget } from './components/AgentWidget';
import { Recording, AgentProfile } from './types';
import { Button } from './components/ui/Button';
import { AuthProvider, useAuth } from './components/AuthProvider';

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const Header: React.FC<{
    onEmbedClick: () => void;
    onNewProfile: () => void;
    onDeleteProfile: () => void;
    profiles: AgentProfile[];
    activeProfile: AgentProfile | null;
    onSelectProfile: (id: string) => void;
    onOpenSettings: () => void;
    onLogout: () => void;
}> = ({ onEmbedClick, onNewProfile, onDeleteProfile, profiles, activeProfile, onSelectProfile, onOpenSettings, onLogout }) => (
    <header className="bg-white dark:bg-gray-800 shadow-sm p-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Voice Agent Dashboard</h1>
            <select
                value={activeProfile?.id || ''}
                onChange={(e) => onSelectProfile(e.target.value)}
                className="p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
                {profiles.map((p: AgentProfile) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button onClick={onNewProfile} variant="secondary">New Profile</Button>
            <Button onClick={onDeleteProfile} variant="danger" disabled={profiles.length <= 1}>Delete Profile</Button>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={onEmbedClick}>Get Embed Code</Button>
          <Button onClick={onOpenSettings} variant="secondary" className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
            Settings
          </Button>
          <Button onClick={onLogout} variant="secondary">Logout</Button>
        </div>
    </header>
);

const DashboardContent: React.FC = () => {
    const { user, loading, error, login, logout } = useAuth();
    const {
        profiles,
        activeProfile,
        selectProfile,
        updateProfile,
        createProfile,
        deleteProfile,
        importProfiles,
        loading: profilesLoading
    } = useAgentProfiles();

    const [recordings, setRecordings] = useLocalStorage<Recording[]>('sessionRecordings', []);
    const [apiKey, setApiKey] = useLocalStorage<string | null>('geminiApiKey', null);
    const [isEmbedModalOpen, setIsEmbedModalOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [notification, setNotification] = useState('');
    const [hasGeminiKey, setHasGeminiKey] = useState(true);

    useEffect(() => {
        const checkApiKey = async () => {
            if (window.aistudio) {
                const hasKey = await window.aistudio.hasSelectedApiKey();
                setHasGeminiKey(hasKey);
            }
        };
        checkApiKey();
    }, []);

    const handleConnectGemini = async () => {
        if (window.aistudio) {
            await window.aistudio.openSelectKey();
            setHasGeminiKey(true);
        }
    };

    const handleSessionEnd = useCallback((recording: Recording) => {
        setRecordings(prev => [...prev, recording]);
    }, [setRecordings]);

    const handleUpdateRecording = useCallback((updatedRecording: Recording) => {
        setRecordings(prev => prev.map(r => r.id === updatedRecording.id ? updatedRecording : r));
    }, [setRecordings]);

    const handleDeleteRecording = (id: string) => {
        setRecordings(prev => prev.filter(rec => {
            if (rec.id === id) {
                URL.revokeObjectURL(rec.url);
                return false;
            }
            return true;
        }));
    };
    
    const handleNewProfile = () => {
        const name = prompt("Enter new profile name:", "New Agent");
        if (name) {
            createProfile(name);
        }
    };

    const handleDeleteProfile = () => {
        if (activeProfile && window.confirm(`Are you sure you want to delete the profile "${activeProfile.name}"?`)) {
            deleteProfile(activeProfile.id);
        }
    };

    const handleProfileUpdate = useCallback((updatedProfile: AgentProfile) => {
        updateProfile(updatedProfile);
        setNotification(`Profile "${updatedProfile.name}" saved. Remember to update any embed codes to apply these changes!`);
        setTimeout(() => setNotification(''), 6000); 
    }, [updateProfile]);

    const handleExportProfiles = () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(profiles, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "voice_agent_profiles_backup.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    };

    const handleImportProfiles = async (file: File) => {
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (Array.isArray(data) && data.length > 0 && data[0].id && data[0].name) {
                if(window.confirm("This will overwrite your current profiles. Are you sure?")) {
                    importProfiles(data);
                    alert("Profiles imported successfully!");
                    setIsSettingsOpen(false);
                }
            } else {
                alert("Invalid backup file format.");
            }
        } catch (e) {
            console.error("Failed to parse backup file", e);
            alert("Failed to read backup file. Please ensure it is a valid JSON file.");
        }
    };

    if (loading) {
        return <div className="bg-gray-100 dark:bg-gray-900 min-h-screen flex items-center justify-center text-white">Loading...</div>;
    }

    if (!user) {
        return (
            <div className="bg-gray-100 dark:bg-gray-900 min-h-screen flex items-center justify-center">
                <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">AI Voice Agent Dashboard</h1>
                    <p className="text-gray-600 dark:text-gray-400 mb-8">Please sign in to manage your agents securely.</p>
                    
                    {error && (
                        <div className="mb-6 p-4 bg-red-100 border-l-4 border-red-500 text-red-700 text-sm text-left dark:bg-red-900/30 dark:text-red-300">
                            <p className="font-bold">Login Error</p>
                            <p>{error}</p>
                        </div>
                    )}

                    <Button onClick={login} className="w-full py-3 text-lg">Sign in with Google</Button>
                </div>
            </div>
        );
    }

    if (profilesLoading || !activeProfile) {
        return <div className="bg-gray-100 dark:bg-gray-900 min-h-screen flex items-center justify-center text-white">Loading profiles...</div>;
    }

    return (
        <div className="bg-gray-100 dark:bg-gray-900 min-h-screen">
            <Header
                onEmbedClick={() => setIsEmbedModalOpen(true)}
                onNewProfile={handleNewProfile}
                onDeleteProfile={handleDeleteProfile}
                profiles={profiles}
                activeProfile={activeProfile}
                onSelectProfile={selectProfile}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onLogout={logout}
            />
            {activeProfile?.id === 'fallback-local' && (
              <div className="max-w-4xl mx-auto mt-4 px-8">
                <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 dark:bg-red-900/50 dark:text-red-300" role="alert">
                  <p className="font-bold">Database Connection Error</p>
                  <p className="text-sm">
                    We couldn't connect to your Firestore database. The app is running in <b>Offline Mode</b>. 
                    Changes will not be saved. Please ensure your Firebase Security Rules are set to "Allow Read/Write" in your Firebase Console.
                  </p>
                </div>
              </div>
            )}
            {notification && (
              <div className="max-w-4xl mx-auto mt-4 px-8">
                <div className="bg-blue-100 border-l-4 border-blue-500 text-blue-700 p-4 dark:bg-blue-900/50 dark:text-blue-300" role="alert">
                  <div className="flex">
                    <div className="py-1"><svg className="fill-current h-6 w-6 text-blue-500 mr-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M2.93 17.07A10 10 0 1 1 17.07 2.93 10 10 0 0 1 2.93 17.07zm12.73-1.41A8 8 0 1 0 4.34 4.34a8 8 0 0 0 11.32 11.32zM9 11V9h2v6H9v-4zm0-6h2v2H9V5z"/></svg></div>
                    <div>
                        <p className="font-bold">Profile Saved</p>
                        <p className="text-sm">{notification}</p>
                    </div>
                    <button onClick={() => setNotification('')} className="ml-auto p-1 self-start" aria-label="Close notification">
                        <svg className="fill-current h-6 w-6 text-blue-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.819l-2.651 3.029a1.2 1.2 0 1 1-1.697-1.697l2.758-3.15-2.759-3.152a1.2 1.2 0 1 1 1.697-1.697L10 8.183l2.651-3.031a1.2 1.2 0 1 1 1.697 1.697l-2.758 3.152 2.758 3.15a1.2 1.2 0 0 1 0 1.698z"/></svg>
                    </button>
                  </div>
                </div>
              </div>
            )}
            <main className="p-8 max-w-4xl mx-auto">
                {!hasGeminiKey && (
                    <div className="mb-6 p-6 bg-indigo-50 border-2 border-indigo-200 rounded-2xl dark:bg-indigo-900/20 dark:border-indigo-800">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-lg font-bold text-indigo-900 dark:text-indigo-100">Connect Gemini API</h3>
                                <p className="text-indigo-700 dark:text-indigo-300 text-sm mt-1">
                                    To use the voice agent, you need to connect your Gemini API key.
                                </p>
                            </div>
                            <Button onClick={handleConnectGemini}>Connect Now</Button>
                        </div>
                    </div>
                )}
                <ConfigurationPanel
                    profile={activeProfile}
                    onProfileChange={handleProfileUpdate}
                />
            </main>
            <AgentWidget
                agentProfile={activeProfile}
                apiKey={apiKey || process.env.GEMINI_API_KEY || ''}
                isWidgetMode={false}
                onSessionEnd={handleSessionEnd}
            />
            <EmbedCodeModal
                isOpen={isEmbedModalOpen}
                onClose={() => setIsEmbedModalOpen(false)}
                agentProfile={activeProfile}
            />
            <SettingsModal
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
                onExportProfiles={handleExportProfiles}
                onImportProfiles={handleImportProfiles}
            />
        </div>
    );
};

const App: React.FC = () => {
    return (
        <AuthProvider>
            <DashboardContent />
        </AuthProvider>
    );
};

export default App;
