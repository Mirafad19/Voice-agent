
import React, { useState, useCallback } from 'react';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useAgentProfiles } from './hooks/useAgentProfiles';
import { ApiKeyModal } from './components/ApiKeyModal';
import { ConfigurationPanel } from './components/ConfigurationPanel';
import { RecordingsPanel } from './components/RecordingsPanel';
import { EmbedCodeModal } from './components/EmbedCodeModal';
import { AgentWidget } from './components/AgentWidget';
import { Recording } from './types';
import { Button } from './components/ui/Button';

const Header = ({ onEmbedClick, onNewProfile, onDeleteProfile, profiles, activeProfile, onSelectProfile }) => (
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
        <Button onClick={onEmbedClick}>Get Embed Code</Button>
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

    const handleApiKeySubmit = (key: string) => {
        setApiKey(key);
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
            />
            <main className="p-8 max-w-4xl mx-auto">
                <ConfigurationPanel
                    profile={activeProfile}
                    onProfileChange={updateProfile}
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
