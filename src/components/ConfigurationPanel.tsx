
import React, { useState, useEffect, useMemo } from 'react';
import { AgentProfile, WidgetTheme, AgentVoice, AccentColor, EmailConfig, FileUploadConfig } from '../types';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Button } from './ui/Button';

interface ConfigurationPanelProps {
  profile: AgentProfile;
  onProfileChange: (updatedProfile: AgentProfile) => void;
}

const accentColorOptions = [
    { name: 'Red', value: AccentColor.Red, color: 'bg-accent-red' },
    { name: 'Orange', value: AccentColor.Orange, color: 'bg-accent-orange' },
    { name: 'Gold', value: AccentColor.Gold, color: 'bg-accent-gold' },
    { name: 'Cyan', value: AccentColor.Cyan, color: 'bg-accent-cyan' },
    { name: 'Pink', value: AccentColor.Pink, color: 'bg-accent-pink' },
    { name: 'Lime', value: AccentColor.Lime, color: 'bg-accent-lime' },
    { name: 'Violet', value: AccentColor.Violet, color: 'bg-accent-violet' },
    { name: 'Teal', value: AccentColor.Teal, color: 'bg-accent-teal' },
    { name: 'Emerald', value: AccentColor.Emerald, color: 'bg-accent-emerald' },
    { name: 'Sky', value: AccentColor.Sky, color: 'bg-accent-sky' },
    { name: 'Rose', value: AccentColor.Rose, color: 'bg-accent-rose' },
    { name: 'Black', value: AccentColor.Black, color: 'bg-accent-black' },
];

export const ConfigurationPanel: React.FC<ConfigurationPanelProps> = ({ profile, onProfileChange }) => {
  const [editedProfile, setEditedProfile] = useState<AgentProfile>(profile);

  useEffect(() => {
    setEditedProfile(profile);
  }, [profile]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(profile) !== JSON.stringify(editedProfile);
  }, [profile, editedProfile]);

  const handleChange = <K extends keyof AgentProfile,>(key: K, value: AgentProfile[K]) => {
    setEditedProfile(prev => ({ ...prev, [key]: value }));
  };

  const handleEmailConfigChange = <K extends keyof EmailConfig,>(key: K, value: EmailConfig[K]) => {
    setEditedProfile(prev => ({
      ...prev,
      emailConfig: {
        ...(prev.emailConfig || { formspreeEndpoint: '' }),
        [key]: typeof value === 'string' ? value.trim() : value
      }
    }));
  };

  const handleFileUploadConfigChange = <K extends keyof FileUploadConfig,>(key: K, value: FileUploadConfig[K]) => {
    const cleanValue = typeof value === 'string' ? value.trim() : value;
    setEditedProfile(prev => ({
      ...prev,
      fileUploadConfig: {
        ...(prev.fileUploadConfig || { cloudinaryCloudName: '', cloudinaryUploadPreset: '' }),
        [key]: cleanValue
      }
    }));
  };

  const handleSave = () => {
    onProfileChange(editedProfile);
  };

  const handleReset = () => {
    setEditedProfile(profile);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="space-y-6">
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2">Global Settings</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="Agent Name"
              id="agentName"
              value={editedProfile.name}
              onChange={(e) => handleChange('name', e.target.value)}
            />
            
            <div>
              <Input
                label="Widget Callout Message"
                id="calloutMessage"
                value={editedProfile.calloutMessage || ''}
                onChange={(e) => handleChange('calloutMessage', e.target.value)}
                placeholder="e.g., Hey there! How can I help?"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Pop-up message above the widget.</p>
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Select
            label="Theme"
            id="theme"
            value={editedProfile.theme}
            onChange={(e) => handleChange('theme', e.target.value as WidgetTheme)}
          >
            <option value={WidgetTheme.Light}>Light</option>
            <option value={WidgetTheme.Dark}>Dark</option>
          </Select>

          <Select
            label="Agent Voice"
            id="voice"
            value={editedProfile.voice}
            onChange={(e) => handleChange('voice', e.target.value as AgentVoice)}
          >
            {Object.values(AgentVoice).map(voice => (
              <option key={voice} value={voice}>{voice}</option>
            ))}
          </Select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Accent Color
          </label>
          <div className="flex flex-wrap items-center gap-3">
            {accentColorOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className={`w-8 h-8 rounded-full ${option.color} transition-transform transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-white dark:focus:ring-offset-gray-800 focus:ring-${option.value}-500 ${editedProfile.accentColor === option.value ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-black dark:ring-white' : ''}`}
                onClick={() => handleChange('accentColor', option.value)}
                title={option.name}
              />
            ))}
          </div>
        </div>
        
        {/* Voice Specific Settings */}
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2 pt-4">Voice Configuration</h3>
        
        <div>
          <Input
            label="Voice Greeting (Spoken)"
            id="initialGreeting"
            value={editedProfile.initialGreeting || ''}
            onChange={(e) => handleChange('initialGreeting', e.target.value)}
            placeholder="e.g., Hello, welcome to P-S-S-D-C."
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Spoken by the AI when the call starts. Use phonetic spelling here (e.g., "P-S-S-D-C") for better pronunciation.</p>
        </div>

        <div>
          <label htmlFor="knowledgeBase" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Voice System Instructions (Knowledge Base)
          </label>
          <textarea
            id="knowledgeBase"
            rows={5}
            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
            value={editedProfile.knowledgeBase}
            onChange={(e) => handleChange('knowledgeBase', e.target.value)}
          />
           <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Rules for the Voice Agent. Keep responses concise and spoken-word friendly.</p>
        </div>

        {/* Chat Specific Settings */}
        <h3 className="text-xl font-semibold text-gray-900 dark:text-white border-b border-gray-200 dark:border-gray-700 pb-2 pt-4">Chat Configuration</h3>

        <div>
          <Input
            label="Chat Welcome Message (Text)"
            id="initialGreetingText"
            value={editedProfile.initialGreetingText || ''}
            onChange={(e) => handleChange('initialGreetingText', e.target.value)}
            placeholder="e.g., Hello! Welcome to PSSDC."
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Displayed in the chat window. Keep this clean (e.g., "PSSDC"). If left blank, it uses the Voice Greeting.</p>
        </div>

        <div>
          <label htmlFor="chatKnowledgeBase" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Chat System Instructions (Knowledge Base)
          </label>
          <textarea
            id="chatKnowledgeBase"
            rows={5}
            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white"
            value={editedProfile.chatKnowledgeBase || ''}
            onChange={(e) => handleChange('chatKnowledgeBase', e.target.value)}
          />
           <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Rules for the Chat Agent. You can encourage Markdown, bullet points, and more detailed text answers. If left blank, it uses the Voice Instructions.</p>
        </div>


        <details className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
          <summary className="font-semibold cursor-pointer text-gray-900 dark:text-white">Cloud Audio Storage (via Cloudinary)</summary>
          <div className="mt-4 space-y-4 text-sm text-gray-600 dark:text-gray-400">
              <p>
                  To include a playable audio link in email reports, the app uploads recordings to cloud storage. This method uses a free <a href="https://cloudinary.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Cloudinary</a> account, which is simpler and more reliable than other options.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Input
                      label="Cloudinary Cloud Name"
                      id="cloudinaryCloudName"
                      type="text"
                      placeholder="Your Cloudinary cloud name"
                      value={editedProfile.fileUploadConfig?.cloudinaryCloudName || ''}
                      onChange={(e) => handleFileUploadConfigChange('cloudinaryCloudName', e.target.value)}
                  />
                  <Input
                      label="Cloudinary Upload Preset"
                      id="cloudinaryUploadPreset"
                      type="text"
                      placeholder="Your Cloudinary unsigned preset"
                      value={editedProfile.fileUploadConfig?.cloudinaryUploadPreset || ''}
                      onChange={(e) => handleFileUploadConfigChange('cloudinaryUploadPreset', e.target.value)}
                  />
              </div>
          </div>
        </details>

        <details className="border border-gray-200 dark:border-gray-700 rounded-lg p-4" open>
            <summary className="font-semibold cursor-pointer text-gray-900 dark:text-white">Automated Email Reports (via Formspree)</summary>
            <div className="mt-4 space-y-4">
                <p className="text-sm text-gray-600 dark:text-gray-400">
                    This app uses <a href="https://formspree.io/" target="_blank" rel="noopener noreferrer" className="text-indigo-500 hover:underline">Formspree</a>, a free service, to automatically send email reports after a session.
                </p>
                <Input
                    label="Formspree Endpoint URL"
                    id="formspreeEndpoint"
                    type="url"
                    placeholder="https://formspree.io/f/your_form_id"
                    value={editedProfile.emailConfig?.formspreeEndpoint || ''}
                    onChange={(e) => handleEmailConfigChange('formspreeEndpoint', e.target.value)}
                />
            </div>
        </details>
      </div>

      <div className="flex justify-end items-center space-x-4 pt-6 mt-6 border-t border-gray-200 dark:border-gray-700">
        <span className={`text-sm text-gray-500 dark:text-gray-400 transition-opacity ${hasChanges ? 'opacity-100' : 'opacity-0'}`}>
            You have unsaved changes.
        </span>
        <Button onClick={handleReset} variant="secondary" disabled={!hasChanges}>
          Reset
        </Button>
        <Button onClick={handleSave} disabled={!hasChanges}>
          Save Configuration
        </Button>
      </div>
    </div>
  );
};
