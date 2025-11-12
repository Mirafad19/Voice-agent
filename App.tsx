

import React, { useState, useCallback } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAgentProfiles } from './hooks/useAgentProfiles';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { RecordingsPanel } from './components/RecordingsPanel';
import { EmbedCodeModal } from './components/EmbedCodeModal';
import { AgentWidget } from './components/AgentWidget';
import { Recording, AgentProfile } from './types';
import { Button } from './components/ui/Button';

const Header = ({ onEmbedClick, onNewProfile, onDeleteProfile, profiles, activeProfile, onSelectProfile, onResetApiKey }) => (
    <header className="bg-white dark:bg-gray-800 shadow-sm p-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">AI Voice Agent Dashboard</h1>
            <select
                value={activeProfile?.id || ''}
                onChange={(e) => onSelectProfile(e.target.value)}
                className="p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            >
                {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <Button onClick={onNewProfile} variant="secondary">New Profile</Button>
            <Button onClick={onDeleteProfile} variant="danger" disabled={profiles.length <= 1}>Delete Profile</Button>
        </div>
        <div className="flex items-center space-x-2">
          <Button onClick={onEmbedClick}>Get Embed Code</Button>
          <Button onClick={onResetApiKey} variant="secondary">Change API Key</Button>
        </div>
    </header>
);

const App: React.FC = () => {
    const [apiKey, setApiKey] = useLocalStorage<string | null>('geminiApiKey', null);
    const {
        profiles,
        activeProfile,
        selectProfile,
        updateProfile,
        createProfile,
        deleteProfile,
    } = useAgentProfiles();

    const [recordings, setRecordings] = useLocalStorage<Recording[]>('sessionRecordings', []);
    const [isEmbedModalOpen, setIsEmbedModalOpen] = useState(false);
    const [notification, setNotification] = useState('');

    const handleApiKeySubmit = (key: string) => {
        setApiKey(key);
    };
    
    const handleResetApiKey = () => {
        setApiKey(null);
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
        setTimeout(() => setNotification(''), 6000); // auto-dismiss after 6 seconds
    }, [updateProfile]);

    if (!apiKey) {
        return <ApiKeyModal onApiKeySubmit={handleApiKeySubmit} />;
    }

    if (!activeProfile) {
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
                onResetApiKey={handleResetApiKey}
            />
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
                <ConfigurationPanel
                    profile={activeProfile}
                    onProfileChange={handleProfileUpdate}
                />
                <RecordingsPanel 
                    recordings={recordings} 
                    onDelete={handleDeleteRecording}
                    onUpdate={handleUpdateRecording}
                    apiKey={apiKey}
                    profile={activeProfile}
                />
            </main>
            <AgentWidget
                agentProfile={activeProfile}
                apiKey={apiKey}
                isWidgetMode={false}
                onSessionEnd={handleSessionEnd}
            />
            <EmbedCodeModal
                isOpen={isEmbedModalOpen}
                onClose={() => setIsEmbedModalOpen(false)}
                agentProfile={activeProfile}
                apiKey={apiKey}
            />
        </div>
    );
};

export default App;